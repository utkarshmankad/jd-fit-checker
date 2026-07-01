export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  resume_text: string | null;
  resume_parsed: ParsedResume | null;
  hard_reject_filters: HardRejectFilters;
  preferences: UserPreferences;
  api_key_encrypted: string | null;
  api_provider: 'openai' | 'anthropic' | null;
  tier: 'free' | 'paid';
  screens_used_this_month: number;
  created_at: string;
  updated_at: string;
}

export interface ParsedResume {
  skills: string[];
  titles: string[];
  years_of_experience: number;
  domains: string[];
  certifications: string[];
  education: string[];
  companies: string[];
  summary: string;
}

export interface HardRejectFilters {
  tech_stack_dealbreakers: string[];
  title_floor: string;
  geography_allowed: string[];
  company_type_excluded: string[];
  role_type_excluded: string[];
}

export interface UserPreferences {
  preferred_tech_stack: string[];
  target_industries: string[];
  min_company_size: number | null;
  max_company_size: number | null;
  onboarding_completed?: boolean;
}

export interface ScreeningResult {
  id: string;
  user_id: string;
  batch_id: string;
  job_url: string | null;
  job_title: string | null;
  company: string | null;
  jd_text: string;
  ats_score: number;
  role_level_score: number;
  composite_score: number;
  verdict: 'STRONG' | 'DECENT' | 'WEAK' | 'REJECT';
  hard_reject_reasons: string[];
  analysis_json: AnalysisResult;
  created_at: string;
}

export interface RequirementCheck {
  requirement: string;
  status: 'met' | 'partial' | 'missing';
  evidence?: string;
}

export interface AnalysisResult {
  ats_score: number;
  role_level_score: number;
  composite_score: number;
  verdict: 'STRONG' | 'DECENT' | 'WEAK' | 'REJECT';
  hard_reject_triggered: boolean;
  hard_reject_reasons: string[];
  headline?: string;
  matching_skills: string[];
  missing_skills: string[];
  requirements_met?: RequirementCheck[];
  soft_concerns?: string[];
  role_level_assessment: string;
  gap_analysis: string;
  recommendation: string;
}

export interface SharedReport {
  id: string;
  user_id: string;
  batch_id: string;
  slug: string;
  results_snapshot: ScreeningResult[];
  expires_at: string;
  created_at: string;
}

export type TrackedJobStatus = 'Applied' | 'Interviewing' | 'Offer' | 'Rejected' | 'Withdrawn';

export interface TrackedJob {
  id: string;
  user_id: string;
  screening_result_id: string | null;
  job_title: string | null;
  company: string | null;
  job_url: string | null;
  status: TrackedJobStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
