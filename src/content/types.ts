/**
 * Content layer types — the clinician's decision tree, as data.
 *
 * The app is a RENDERER of this data, never an inference engine. It walks the
 * tree she authored and shows what she attached to that leaf. If the tree has
 * no answer for a path, it says so and offers a human. It never guesses.
 */

export type Sex = 'male' | 'female';
export type AgeBand = 'teen' | 'adult' | 'older_adult' | 'senior';
export type Locale = 'en' | 'ar';

/** Publication gate. Only `published` + a signer ever reaches a patient. */
export type Status = 'draft' | 'published';

export type Reviewed = {
  status: Status;
  /** clinician who signed this row. Empty until she signs. */
  reviewedBy: string;
  /** ISO date */
  reviewedOn: string;
};

/** Bilingual string. Arabic is first-class, not an afterthought. */
export type I18nText = { en: string; ar: string };

export type Irritability = 'quick' | 'hours' | 'day';

export type PrecautionAction = 'hide' | 'warn' | 'stop_and_refer';

/**
 * A coarse area the exercise library is organised by, mapping to one or more
 * of the 81 fine-grained viewer regions.
 */
export type BodyArea = {
  id: string;
  label: I18nText;
  /** viewer region ids that land the patient in this area */
  regionIds: string[];
};

export type AnswerOption = {
  id: string;
  /** token used in answer paths, e.g. "overhead" */
  key: string;
  label: I18nText;
  /**
   * Stop-and-see-someone. Short-circuits the flow to an escalation message
   * before any routing happens. Requires `escalationId`.
   */
  redFlag?: boolean;
  escalationId?: string;
};

export type Question = Reviewed & {
  id: string;
  /** `global` = asked for every area (symptom picture). */
  bodyArea: string;
  /** token used in answer paths, e.g. "movement" */
  key: string;
  prompt: I18nText;
  /** optional clarifier under the prompt */
  hint?: I18nText;
  options: AnswerOption[];
  order: number;
  skippable: boolean;
};

export type EscalationMessage = Reviewed & {
  id: string;
  title: I18nText;
  body: I18nText;
  cta: 'contact' | 'urgent' | 'none';
  tone?: 'stop' | 'warn' | 'reassure';
};

/** Unskippable safety wall. Any positive answer ends the flow. */
export type RedFlag = Reviewed & {
  id: string;
  prompt: I18nText;
  /** option key that counts as positive (typically `yes`) */
  positiveKey: string;
  messageId: string;
  order: number;
};

/**
 * Closed-list precaution. May hide, warn, or stop. Never substitutes.
 * Labels must not name diagnoses — clinician-authored category wording only.
 */
export type Precaution = Reviewed & {
  conditionKey: string;
  label: I18nText;
  restrictsTags: string[];
  restrictsIds: string[];
  action: PrecautionAction;
  messageId: string;
};

export type ThresholdKey =
  | 'nrs_referral'
  | 'amber_window_hours'
  | 'rising_sessions_n'
  | 'review_weeks'
  | 'reminder_days';

export type Threshold = Reviewed & {
  key: ThresholdKey;
  value: number;
};

export type Exercise = Reviewed & {
  id: string;
  bodyArea: string;
  name: I18nText;
  /** what it's for, in her words */
  purpose: I18nText;
  /** sets/reps/hold/frequency, verbatim */
  dosage: I18nText;
  /** her safety / stop line */
  safety: I18nText;
  /** ordered steps */
  steps: I18nText[];
  /** empty = suits everyone. Filters may only ever HIDE. */
  suitsSex?: Sex;
  suitsAgeBands?: AgeBand[];
  precautionTags?: string[];
  irritabilityMax?: Irritability;
  mediaStillId?: string;
  mediaClipId?: string;
};

export type Route = Reviewed & {
  id: string;
  bodyArea: string;
  /** canonical normalised answer path, e.g. "duration=weeks&movement=overhead" */
  answerPath: string;
} & (
    | { outcome: 'exercises'; exerciseIds: string[] }
    | { outcome: 'escalate'; escalationId: string }
  );

export type ContentBundle = {
  bodyAreas: BodyArea[];
  questions: Question[];
  routes: Route[];
  exercises: Exercise[];
  escalations: EscalationMessage[];
  redFlags: RedFlag[];
  precautions: Precaution[];
  thresholds: Threshold[];
};
