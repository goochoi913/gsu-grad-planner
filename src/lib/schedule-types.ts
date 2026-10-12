/**
 * Shapes of the generated class-schedule data:
 *   src/data/spring2027.json   ← scripts/build-schedule.mjs (the CSVs in data/sources/, enriched
 *                                from GSU's public class search)
 *   src/data/professors.json   ← scripts/fetch-rmp.mjs (RateMyProfessors, Georgia State = school 360)
 */

/** Day codes match the planner's meeting blocks (DAY_ORDER in src/data/degree.ts), plus weekends. */
export type DayCode = 'M' | 'T' | 'W' | 'Th' | 'F' | 'Sa' | 'Su'

export interface Meeting {
  /** Empty when the time is TBA (online asynchronous, research, independent study). */
  days: DayCode[]
  /** 24-hour "HH:MM", or null when TBA. */
  start: string | null
  end: string | null
  /** "Langdale Hall"; null when there is no room (TBA, online). */
  building: string | null
  room: string | null
  /** ISO dates, e.g. "2027-01-11". */
  startDate: string
  endDate: string
  /** The meeting is online (building "Online"): synchronous when it has days and times. */
  online: boolean
}

export interface Instructor {
  /** As GSU lists it, minus "(Primary)" and stray dots: "Gao, Chunlan (Lan)". */
  name: string
  /** How a student says it: "Lan Gao". */
  display: string
  /** Key into professors.json. */
  key: string
  primary: boolean
}

export type SectionMode = 'in-person' | 'online-sync' | 'online-async' | 'hybrid' | 'arranged'

export interface Section {
  crn: string
  subject: string
  /** "3210", "3210L", "1301L" */
  number: string
  /** "CSC 3210L" */
  code: string
  /** "CSC3210L" — the planner's codeToId() form */
  codeId: string
  /** Section number without leading zeros: "4" */
  section: string
  /** Section title with the schedule type stripped, HTML entities decoded: "COMPUTER ORG & PROGRAMMING" */
  title: string
  /** Credit hours; null when variable ("1 TO 6"). */
  credits: number | null
  /** As listed: "3", "1 TO 6" */
  creditsText: string
  /** "Lecture", "Supervised Laboratory", "Lecture/Supervised Laboratory", "Independent Study (Correspond)", … */
  scheduleType: string
  /** "Atlanta", "Online - Atl US (Mand. Fees)", "Off Campus-Tech & USG Fee only" */
  campus: string
  mode: SectionMode
  instructors: Instructor[]
  meetings: Meeting[]
  seats: {
    remaining: number
    capacity: number
    full: boolean
    /** When this count was read: the CSV copy, or the class-search fetch. ISO timestamp. */
    asOf: string
    source: 'csv' | 'banner'
  }
  waitlist: { capacity: number; count: number; remaining: number } | null
  honors: boolean
  /** Sections that run only part of the term (7-week sessions). Null for the full term. */
  session: { label: string; start: string; end: string } | null
  /** Notable class-search attributes: "Honors College", "Synchronous Online", "Critical Thinking Through Writing", … */
  attributes: string[]
  /** "csv" for rows from the CSV files (the main source); "banner" for sections added from GSU's class search. */
  source: 'csv' | 'banner'
  /** Differences between the CSV and GSU's class search, in plain words. */
  notes: string[]
}

export interface ScheduleCourse {
  subject: string
  number: string
  code: string
  codeId: string
  /** Title of the first section (sections of a topics course can differ — see Section.title). */
  title: string
  sections: Section[]
}

export interface TermSchedule {
  /** The planner's term id: "spring2027" */
  termId: string
  label: string
  /** GSU class-search term code: "202701" */
  bannerTerm: string
  classesStart: string
  classesEnd: string
  generatedAt: string
  sources: {
    csv: { file: string; rows: number }[]
    banner: { fetchedAt: string; subjects: string[]; added: number; checked: number } | null
  }
  courses: ScheduleCourse[]
}

export interface ProfessorRating {
  legacyId: number
  /** https://www.ratemyprofessors.com/professor/<legacyId> */
  url: string
  firstName: string
  lastName: string
  department: string
  /** null when the professor has no ratings yet. */
  avgRating: number | null
  avgDifficulty: number | null
  numRatings: number
  /** null when RMP has no answer (it reports -1). */
  wouldTakeAgainPercent: number | null
  /** Most-used tags, most frequent first: "Tough grader", "Gives good feedback", … */
  tags: { name: string; count: number }[]
}

export interface Professor {
  key: string
  name: string
  display: string
  /** RMP search restricted to Georgia State, for when there is no confident match. */
  searchUrl: string
  rmp: ProfessorRating | null
  /** How the RMP profile was chosen: an exact name match, a manual override, or none. */
  match: 'exact' | 'override' | 'none' | 'ambiguous'
}

export interface ProfessorsFile {
  schoolId: number
  schoolName: string
  fetchedAt: string
  professors: Record<string, Professor>
}
