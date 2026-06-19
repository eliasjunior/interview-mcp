import type { AlgorithmProblemTrackerItem } from "@mock-interview/shared";

export interface AlgorithmProblemRepository {
  list(): AlgorithmProblemTrackerItem[];
  getById(id: string): AlgorithmProblemTrackerItem | null;
  getByProblem(problem: string): AlgorithmProblemTrackerItem | null;
  insert(item: AlgorithmProblemTrackerItem): void;
  update(item: AlgorithmProblemTrackerItem): void;
  deleteById(id: string): boolean;
}
