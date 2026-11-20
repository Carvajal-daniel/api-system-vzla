import { InvalidTimeRangeError } from "../errors/appointment-errors.js";

export class TimeRange {
  private constructor(
    public readonly startsAt: Date,
    public readonly endsAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(startsAt: Date, endsAt: Date): TimeRange {
    if (
      !(startsAt instanceof Date) ||
      !(endsAt instanceof Date) ||
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime())
    ) {
      throw new InvalidTimeRangeError("Start and end times must be valid dates.");
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new InvalidTimeRangeError();
    }

    return new TimeRange(new Date(startsAt.getTime()), new Date(endsAt.getTime()));
  }

  /**
   * Verifica sobreposição estrita entre intervalos semiabertos [startsAt, endsAt).
   * Intervalos contíguos (ex.: 09:00-09:45 e 09:45-10:30) NÃO se sobrepõem.
   */
  overlaps(other: TimeRange): boolean {
    return (
      this.startsAt.getTime() < other.endsAt.getTime() &&
      this.endsAt.getTime() > other.startsAt.getTime()
    );
  }
}
