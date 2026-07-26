export type Direction = 1 | 2; // 1: 横書き, 2: 縦書き

export const Direction = {
  Horizon: 1 as Direction,
  Vertical: 2 as Direction,
};

export type AnswerType = 1 | 2 | 3; // 1: テキスト, 2: 選択, 3: 画像(手書き)

export const AnswerType = {
  Text: 1 as AnswerType,
  Choice: 2 as AnswerType,
  Image: 3 as AnswerType,
};

export interface CurrentUser {
  user: {
    login_id: string;
    id: number;
    role: string;
    name: string;
    school: { id: number; name: string };
  };
}

export interface StudentSheetListResponse {
  student_subject_rows: StudentSubjectRow[];
  max_report_count: number | null;
  report_nos: number[];
  sheet_types: number[];
}

export interface StudentSubjectRow {
  student_subject: {
    subject_code: string;
    nendo: number;
    report_count: number;
    subject_name: string;
  };
  student_sheets: (StudentSheetSummary | null)[];
  base_sheets: BaseSheetSummary[];
}

export interface StudentSheetSummary {
  id: number;
  base_sheet_id: number;
  times: number;
  status: number;
  score: number | null;
  submitted_at: string | null;
}

export interface BaseSheetSummary {
  id: number;
  sheet_code: string;
  report_no: number;
  answer_image_completed: boolean;
  is_published: boolean;
  publish_at: string | null;
  std_deadline_at: string | null;
  final_deadline_at: string | null;
  sheet_type: number;
}

export interface AnswerText {
  id: number | null;
  base_sheet_field_id: number | null;
  idx: number | null;
  text: string | null;
  color: string | null;
  font_size: number | null;
  line_height: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  direction: Direction | null;
}

export interface AnswerImage {
  id: number | null;
  base_sheet_field_id: number | null;
  idx: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  base64_image?: string; // 取得時のみ付与(サーバレスポンスには入っていないことが多いので別途保持)
}

export interface BaseSheetField {
  id: number;
  page: number;
  kind: number; // 0: 通常設問, 9: 氏名欄など
  field_name?: string;
  part1: string | null;
  part2: string | null;
  part3: string | null;
  allot: number | null;
  rim: [number, number, number, number]; // [x, y, width, height]
  answer_type: AnswerType;
  answer_texts: AnswerText[];
  answer_images: AnswerImage[];
  base64_canvas: string | null;
  choice_texts: string[];
  correct_state?: unknown;
  sheet_field_mark?: boolean;
}

export interface BaseSheet {
  id: number;
  width: number;
  height: number;
  sheet_type: number;
  correct_image_size?: [number, number];
}

export interface DigitalReportResponse {
  base_sheet: BaseSheet;
  base_sheet_fields: BaseSheetField[];
  base64_question_images: string[];
  base64_answer_images: string[];
  message: string | null;
  before_student_sheet_id: number | null;
  subject_name: string;
  cut_margin: number;
  scored_user_name: string | null;
  answer_image_discriptions: unknown[];
  question_image_discriptions: unknown[];
  rejection_student_sheet_log: unknown;
  status: number;
  movie_contents: unknown[];
}

export interface DigitalReportQuery {
  subject_code: string;
  nendo: number;
  report_no: number;
  student_code: string;
  is_preview_mode: boolean;
  times?: number;
}

// POST save/entry に送る param_base_sheet_fields の要素(app.js の Do クラス相当)
export interface ParamBaseSheetField {
  id: number;
  page: number;
  kind: number;
  field_name?: string;
  rim: [number, number, number, number];
  correct_state?: unknown;
  answer_texts: ParamAnswerText[];
  answer_images: ParamAnswerImage[];
}

export interface ParamAnswerText {
  id: number | null;
  base_sheet_field_id: number | null;
  text: string | null;
  idx: number | null;
  font_size: number | null;
  line_height: number | null;
  color: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  direction: Direction | null;
}

export interface ParamAnswerImage {
  id: number | null;
  base_sheet_field_id: number | null;
  idx: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export interface SaveErrorResponse {
  errors: string[];
}
