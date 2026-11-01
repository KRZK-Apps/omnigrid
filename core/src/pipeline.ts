import type { GridState } from "./types";

/**
 * Stages of the data pipeline executed in ascending order.
 * - `filter`: eliminates rows that do not match active predicates
 * - `sort`: orders rows by one or more comparator keys
 * - `group`: builds hierarchy or inserts group headers
 * - `aggregate`: computes summary values across groups or totals
 * - `paginate`: slices rows to the active page
 *
 * @api
 */
export type PipelineStage = "filter" | "sort" | "group" | "aggregate" | "paginate";

export const PIPELINE_STAGE_ORDER: Record<PipelineStage, number> = {
    filter: 10,
    sort: 20,
    group: 30,
    aggregate: 40,
    paginate: 50,
};

/**
 * A discrete data transformation processor registered in the grid pipeline.
 *
 * @api
 */
export interface PipelineProcessor<T> {
    /** Optional identifier for debugging and inspection. */
    id?: string;
    /** Pipeline stage where this processor runs. */
    stage: PipelineStage;
    /**
     * Priority within the same stage. Higher numbers run earlier.
     *
     * @default 0
     */
    priority?: number;
    /**
     * Pure function transforming rows.
     * @param data - Rows output by the previous processor.
     * @param state - Current snapshot of the grid state.
     * @returns Transformed rows.
     */
    process: (data: T[], state: GridState<T>) => T[];
}

/**
 * Coordinates extensible data transformation stages.
 *
 * Plugins register processors targeting specific stages (`filter`, `sort`, etc.),
 * ensuring that data transformations always execute in the correct order
 * regardless of when plugins are initialized.
 *
 * @api
 */
export class DataPipeline<T> {
    private readonly processors = new Set<PipelineProcessor<T>>();
    private readonly onInvalidate?: () => void;

    public constructor(onInvalidate?: () => void) {
        this.onInvalidate = onInvalidate;
    }

    /**
     * Registers a new data processor into the pipeline.
     * @param processor - The pipeline processor definition.
     * @returns Cleanup callback to unregister the processor.
     * @api
     */
    public registerProcessor(processor: PipelineProcessor<T>): () => void {
        this.processors.add(processor);
        this.onInvalidate?.();
        return () => {
            this.processors.delete(processor);
            this.onInvalidate?.();
        };
    }

    /**
     * Runs all registered processors against the input dataset in stage order.
     * @param data - Input rows.
     * @param state - Current grid state snapshot.
     * @returns Transformed rows.
     * @api
     */
    public process(data: T[], state: GridState<T>): T[] {
        if (this.processors.size === 0) return data;

        const sorted: PipelineProcessor<T>[] = Array.from(this.processors).sort((a, b) => {
            const stageDiff: number = (PIPELINE_STAGE_ORDER[a.stage] ?? 0) - (PIPELINE_STAGE_ORDER[b.stage] ?? 0);
            if (stageDiff !== 0) return stageDiff;
            return (b.priority ?? 0) - (a.priority ?? 0);
        });

        let current: T[] = data;
        for (let i = 0; i < sorted.length; i += 1) {
            current = sorted[i].process(current, state);
        }
        return current;
    }

    /** Clears all registered processors. @api */
    public clear(): void {
        this.processors.clear();
    }
}
