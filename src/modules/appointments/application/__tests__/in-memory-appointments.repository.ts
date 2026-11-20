import type { Appointment } from "../../domain/entities/appointment.entity.js";
import { AppointmentTimeConflictError } from "../../domain/errors/appointment-errors.js";
import type {
  AppointmentsRepository,
  ListAppointmentsFilter,
} from "../../domain/repositories/appointments.repository.js";
import { TimeRange } from "../../domain/value-objects/time-range.vo.js";

export class InMemoryAppointmentsRepository implements AppointmentsRepository {
  public readonly items: Appointment[] = [];
  // Mutex em memória por `${companyId}:${collaboratorId}` espelhando pg_advisory_xact_lock.
  private readonly locks = new Map<string, Promise<void>>();

  private async withCollaboratorLock<T>(
    companyId: string,
    collaboratorId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${companyId}:${collaboratorId}`;
    const previous = this.locks.get(lockKey) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.then(() => current);
    this.locks.set(lockKey, tail);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(lockKey) === tail) {
        this.locks.delete(lockKey);
      }
    }
  }

  async createWithLock(appointment: Appointment): Promise<void> {
    await this.withCollaboratorLock(
      appointment.companyId,
      appointment.collaboratorId,
      async () => {
        // Simula latência assíncrona real de banco para comprovar que o lock serializa chamadas simultâneas.
        await Promise.resolve();

        const candidateRange = appointment.toTimeRange();
        const hasConflict = this.items.some(
          (existing) =>
            existing.companyId === appointment.companyId &&
            existing.collaboratorId === appointment.collaboratorId &&
            existing.blocksAvailability() &&
            existing.toTimeRange().overlaps(candidateRange),
        );

        if (hasConflict) {
          throw new AppointmentTimeConflictError();
        }

        this.items.push(appointment);
      },
    );
  }

  async rescheduleWithLock(appointment: Appointment): Promise<void> {
    await this.withCollaboratorLock(
      appointment.companyId,
      appointment.collaboratorId,
      async () => {
        await Promise.resolve();

        const candidateRange = appointment.toTimeRange();
        const hasConflict = this.items.some(
          (existing) =>
            existing.id !== appointment.id &&
            existing.companyId === appointment.companyId &&
            existing.collaboratorId === appointment.collaboratorId &&
            existing.blocksAvailability() &&
            existing.toTimeRange().overlaps(candidateRange),
        );

        if (hasConflict) {
          throw new AppointmentTimeConflictError();
        }

        const index = this.items.findIndex(
          (item) =>
            item.companyId === appointment.companyId &&
            item.id === appointment.id,
        );
        if (index !== -1) {
          this.items[index] = appointment;
        }
      },
    );
  }

  async save(appointment: Appointment): Promise<void> {
    const index = this.items.findIndex(
      (item) =>
        item.companyId === appointment.companyId && item.id === appointment.id,
    );
    if (index !== -1) {
      this.items[index] = appointment;
    }
  }

  async findById(
    companyId: string,
    appointmentId: string,
  ): Promise<Appointment | null> {
    return (
      this.items.find(
        (item) => item.companyId === companyId && item.id === appointmentId,
      ) ?? null
    );
  }

  async list(filter: ListAppointmentsFilter): Promise<Appointment[]> {
    return this.items
      .filter((item) => {
        if (item.companyId !== filter.companyId) return false;
        if (
          filter.collaboratorId !== undefined &&
          item.collaboratorId !== filter.collaboratorId
        ) {
          return false;
        }
        if (filter.status !== undefined && item.status !== filter.status) {
          return false;
        }
        if (filter.from && item.endsAt.getTime() <= filter.from.getTime()) {
          return false;
        }
        if (filter.to && item.startsAt.getTime() >= filter.to.getTime()) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async findActiveOverlapping(
    companyId: string,
    rangeStart: Date,
    rangeEnd: Date,
    collaboratorId?: string | null,
  ): Promise<Appointment[]> {
    const queryRange = TimeRange.create(rangeStart, rangeEnd);

    return this.items
      .filter((item) => {
        if (item.companyId !== companyId) return false;
        if (!item.blocksAvailability()) return false;
        if (
          collaboratorId !== undefined &&
          collaboratorId !== null &&
          item.collaboratorId !== collaboratorId
        ) {
          return false;
        }
        return item.toTimeRange().overlaps(queryRange);
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
}
