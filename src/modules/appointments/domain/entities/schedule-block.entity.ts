import crypto from "node:crypto";
import { TimeRange } from "../value-objects/time-range.vo.js";

export interface ScheduleBlockProps {
  id: string;
  companyId: string;
  collaboratorId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleBlockInput {
  companyId: string;
  collaboratorId?: string | null;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export class ScheduleBlock {
  private constructor(private readonly props: ScheduleBlockProps) {}

  static create(input: CreateScheduleBlockInput): ScheduleBlock {
    const timeRange = TimeRange.create(input.startsAt, input.endsAt);
    const normalizedReason =
      input.reason === undefined || input.reason === null
        ? null
        : input.reason.trim() || null;
    const now = new Date();

    return new ScheduleBlock({
      id: crypto.randomUUID(),
      companyId: input.companyId,
      collaboratorId: input.collaboratorId ?? null,
      startsAt: timeRange.startsAt,
      endsAt: timeRange.endsAt,
      reason: normalizedReason,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: ScheduleBlockProps): ScheduleBlock {
    const timeRange = TimeRange.create(props.startsAt, props.endsAt);
    return new ScheduleBlock({
      ...props,
      startsAt: timeRange.startsAt,
      endsAt: timeRange.endsAt,
    });
  }

  get id(): string {
    return this.props.id;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get collaboratorId(): string | null {
    return this.props.collaboratorId;
  }

  get isCompanyWide(): boolean {
    return this.props.collaboratorId === null;
  }

  get startsAt(): Date {
    return this.props.startsAt;
  }

  get endsAt(): Date {
    return this.props.endsAt;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  toTimeRange(): TimeRange {
    return TimeRange.create(this.props.startsAt, this.props.endsAt);
  }
}
