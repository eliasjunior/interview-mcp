import { desc, eq } from "drizzle-orm";
import type { AlgorithmProblemTrackerItem } from "@mock-interview/shared";
import type { AppDb } from "../client.js";
import { algorithmProblems } from "../schema.js";
import type { AlgorithmProblemRepository } from "../../repositories/algorithmProblemRepository.js";

export class SQLiteAlgorithmProblemRepository implements AlgorithmProblemRepository {
  constructor(private readonly db: AppDb) {}

  list(): AlgorithmProblemTrackerItem[] {
    return this.db
      .select()
      .from(algorithmProblems)
      .orderBy(desc(algorithmProblems.updatedAt))
      .all()
      .map((row) => this.hydrate(row));
  }

  getById(id: string): AlgorithmProblemTrackerItem | null {
    const row = this.db.select().from(algorithmProblems).where(eq(algorithmProblems.id, id)).get();
    return row ? this.hydrate(row) : null;
  }

  getByProblem(problem: string): AlgorithmProblemTrackerItem | null {
    const row = this.db.select().from(algorithmProblems).where(eq(algorithmProblems.problem, problem)).get();
    return row ? this.hydrate(row) : null;
  }

  insert(item: AlgorithmProblemTrackerItem): void {
    this.db.insert(algorithmProblems).values(this.dehydrate(item)).run();
  }

  update(item: AlgorithmProblemTrackerItem): void {
    this.db
      .update(algorithmProblems)
      .set(this.dehydrate(item))
      .where(eq(algorithmProblems.id, item.id))
      .run();
  }

  deleteById(id: string): boolean {
    const result = this.db.delete(algorithmProblems).where(eq(algorithmProblems.id, id)).run();
    return result.changes > 0;
  }

  private hydrate(row: typeof algorithmProblems.$inferSelect): AlgorithmProblemTrackerItem {
    return {
      id: row.id,
      problem: row.problem,
      problemDescription: row.problemDescription,
      pattern: row.pattern,
      difficulty: row.difficulty as AlgorithmProblemTrackerItem["difficulty"],
      trickyPart: row.trickyPart,
      mentalModel: row.mentalModel,
      commonMistake: row.commonMistake,
      complexity: row.complexity,
      reSolvedWithoutHelp: row.reSolvedWithoutHelp,
      dateLastReviewed: row.dateLastReviewed ?? undefined,
      nextReviewDays: row.nextReviewDays,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private dehydrate(item: AlgorithmProblemTrackerItem) {
    return {
      id: item.id,
      problem: item.problem,
      problemDescription: item.problemDescription,
      pattern: item.pattern,
      difficulty: item.difficulty,
      trickyPart: item.trickyPart,
      mentalModel: item.mentalModel,
      commonMistake: item.commonMistake,
      complexity: item.complexity,
      reSolvedWithoutHelp: item.reSolvedWithoutHelp,
      dateLastReviewed: item.dateLastReviewed,
      nextReviewDays: item.nextReviewDays,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
