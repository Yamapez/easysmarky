import { apiGet, apiPostForm } from "./client";
import type {
  CurrentUser,
  StudentSheetListResponse,
  DigitalReportResponse,
  DigitalReportQuery,
} from "./types";

export function studentCodeFromLoginId(loginId: string): string {
  // 例: "85_2025HF249" -> "2025HF249"(先頭の学校ID接頭辞 "数字_" を除去)
  return loginId.replace(/^\d+_/, "");
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  return apiGet<CurrentUser>("/api/current_user");
}

export async function fetchStudentSheetList(
  studentCode: string,
): Promise<StudentSheetListResponse> {
  return apiGet<StudentSheetListResponse>(
    `/api/student/student_sheet_list?student_code=${encodeURIComponent(studentCode)}`,
  );
}

export async function fetchDigitalReport(
  query: DigitalReportQuery,
): Promise<DigitalReportResponse> {
  const params = new URLSearchParams({
    subject_code: query.subject_code,
    nendo: String(query.nendo),
    report_no: String(query.report_no),
    student_code: query.student_code,
    is_preview_mode: String(query.is_preview_mode),
  });
  if (query.times != null) params.set("times", String(query.times));
  return apiGet<DigitalReportResponse>(`/api/student/digital_report?${params.toString()}`);
}

export interface SaveDigitalReportParams {
  file: Blob;
  baseSheetId: number;
  studentCode: string;
  times: number;
  paramBaseSheetFields: unknown;
}

export async function saveDigitalReport(params: SaveDigitalReportParams): Promise<unknown> {
  const form = new FormData();
  form.append("file", params.file, "answers.zip");
  form.append("base_sheet_id", String(params.baseSheetId));
  form.append("student_code", params.studentCode);
  form.append("times", String(params.times));
  form.append("param_base_sheet_fields", JSON.stringify(params.paramBaseSheetFields));
  return apiPostForm("/api/student/digital_report/save", form);
}
