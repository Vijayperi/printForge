export interface Clock {
  now(): Date
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}

export class FixedClock implements Clock {
  private current: Date

  constructor(at: Date) {
    this.current = at
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  set(at: Date): void {
    this.current = at
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}
