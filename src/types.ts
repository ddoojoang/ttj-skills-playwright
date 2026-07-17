/**
 * ttj-skills-playwright - Type definitions
 */

export type OS = 'macos' | 'linux' | 'windows';

export type LogType = 'info' | 'success' | 'warning' | 'error';

export interface BrowserConfig {
  port: number;
  profilePath: string;
}

export interface DetectionResult {
  found: boolean;
  path?: string;
}

export interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

export interface ExistingBrowser {
  found: boolean;
  port?: number;
  pid?: number;
}

/**
 * Which data kinds a repeating-list item exposes (content-richness signals).
 */
export interface RepeatingGroupFields {
  title: boolean;
  link: boolean;
  image: boolean;
  price: boolean;
  date: boolean;
}

/**
 * A trimmed preview of one repeating-list item.
 */
export interface RepeatingGroupSample {
  text: string;
  href?: string;
  imgSrc?: string;
}

/**
 * A detected repeating list: 3+ siblings sharing a tag+class signature.
 */
export interface RepeatingGroup {
  containerSelector: string;
  itemSelector: string;
  count: number;
  fields: RepeatingGroupFields;
  samples: RepeatingGroupSample[];
  score: number;
}

/**
 * A visible <table> with its shape and header row.
 */
export interface TableInfo {
  selector: string;
  rows: number;
  columns: number;
  headers: string[];
}

/**
 * A single input control inside a form / input group.
 */
export interface FormInput {
  type: string;
  placeholder?: string;
  name?: string;
}

/**
 * A <form> (or a synthetic group of standalone inputs) with its inputs.
 */
export interface FormInfo {
  selector: string;
  inputs: FormInput[];
}

/**
 * Page-level metadata gathered during analysis.
 */
export interface PageMeta {
  url: string;
  title: string;
  headings: string[];
}

/**
 * Machine-readable structure of the active page, produced by `analyze`.
 * An AI reads this JSON to propose crawlable targets to the user.
 */
export interface PageAnalysis {
  meta: PageMeta;
  repeatingGroups: RepeatingGroup[];
  tables: TableInfo[];
  forms: FormInfo[];
}

/**
 * One step of a `batch` run. `cmd` picks the action; the other fields are
 * that action's arguments (validated at execution time). `selector` on
 * click/fill also accepts a snapshot ref token (e5) — or pass `ref`
 * explicitly.
 */
export interface BatchStep {
  readonly cmd:
    | 'goto'
    | 'click'
    | 'type'
    | 'wait'
    | 'eval'
    | 'screenshot'
    | 'fill'
    | 'press'
    | 'snapshot';
  readonly url?: string;
  readonly selector?: string;
  readonly ref?: string;
  readonly text?: string;
  readonly code?: string;
  readonly path?: string;
  readonly key?: string;
  readonly timeout?: number;
  readonly full?: boolean;
}

export interface BatchStepResult {
  readonly step: number;
  readonly cmd: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}
