import { InvalidTimeOfDayError } from "../errors/work-schedule-errors.js";

const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class TimeOfDay {
  private constructor(
    public readonly value: string,
    private readonly minutes: number,
  ) {}

  static create(raw: string): TimeOfDay {
    const match = TIME_OF_DAY_REGEX.exec(raw);

    if (!match) {
      throw new InvalidTimeOfDayError();
    }

    const hours = Number(match[1]);
    const mins = Number(match[2]);

    return new TimeOfDay(raw, hours * 60 + mins);
  }

  toMinutes(): number {
    return this.minutes;
  }
}
