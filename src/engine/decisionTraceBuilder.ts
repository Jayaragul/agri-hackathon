import { DecisionTraceEntry } from '../domain/models/models'

export class DecisionTraceBuilder {
  private trace: DecisionTraceEntry[] = []

  public addFactor(
    factor: DecisionTraceEntry['factor'],
    inputValue: string | number,
    requiredValue: string | number,
    pointsAwarded: number,
    maximumPoints: number,
    explanation: string
  ): void {
    let status: 'good' | 'warning' | 'critical' = 'good'

    const percentage = maximumPoints > 0 ? (pointsAwarded / maximumPoints) * 100 : 0
    if (percentage < 50) {
      status = 'critical'
    } else if (percentage < 80) {
      status = 'warning'
    }

    this.trace.push({
      factor,
      inputValue,
      requiredValue,
      pointsAwarded,
      maximumPoints,
      status,
      explanation
    })
  }
  
  public addCriticalFailure(
    factor: DecisionTraceEntry['factor'],
    inputValue: string | number,
    requiredValue: string | number,
    explanation: string
  ): void {
    this.trace.push({
      factor,
      inputValue,
      requiredValue,
      pointsAwarded: 0,
      maximumPoints: 0,
      status: 'critical',
      explanation
    })
  }

  public getTrace(): DecisionTraceEntry[] {
    return [...this.trace]
  }

  public getPositiveReasons(): string[] {
    return this.trace
      .filter(t => t.status === 'good' && t.pointsAwarded > 0)
      .map(t => t.explanation)
  }

  public getRiskReasons(): string[] {
    return this.trace
      .filter(t => t.status === 'warning' || (t.status === 'critical' && t.maximumPoints > 0))
      .map(t => t.explanation)
  }

  public getBlockingWarnings(): string[] {
    return this.trace
      .filter(t => t.status === 'critical' && t.maximumPoints === 0)
      .map(t => t.explanation)
  }
}
