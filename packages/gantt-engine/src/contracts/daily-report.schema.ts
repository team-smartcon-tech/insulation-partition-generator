import { z } from "zod"
import { isoDateSchema, stageSchema } from "./schedule.schema.ts"

// 스마트웍스(DCR) 작업일보 계약. 원천은 dcr-app Supabase 이며 이 서비스는 읽기만 한다.

export const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string().nullable(),
  /** 이 현장의 가장 최근 작업일보 날짜. 일보가 없으면 null. 목록은 이 값 내림차순 */
  lastReportDate: isoDateSchema.nullable(),
})

/** 일보 글 한 줄에서 읽어낸 골조 작업 하나. stage 가 null 이면 단계로 못 바꾼 작업(사람 확인 대상). */
export const workEntrySchema = z.object({
  building: z.string(), // "401동"
  buildingNo: z.number().int().nullable(), // 401
  floor: z.number().int().nullable(), // 38 (38F), -1 (B1F)
  /** 숫자로 못 나타내는 층 표기 ("RF") */
  floorLabel: z.string().optional(),
  text: z.string(), // "바닥 먹매김"
  stage: stageSchema.nullable(),
})

export const dailyReportSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  date: isoDateSchema,
  /** dcr aggregation_status: pending | aggregating | completed */
  status: z.string(),
  /** CTPA "주요작업 LIST" 와 같은 원문 (work_summary + work_descriptions) */
  rawText: z.string(),
  /** 골조 구간에서 읽어낸 작업들 */
  entries: z.array(workEntrySchema),
  /** 골조 구간에 있었지만 동·작업으로 못 읽은 줄 */
  unmatched: z.array(z.string()),
})

export const sitesResponseSchema = z.object({ sites: z.array(siteSchema) })

export const dailyReportsQuerySchema = z.object({
  siteId: z.string().min(1),
  from: isoDateSchema,
  to: isoDateSchema,
})

export const dailyReportsResponseSchema = z.object({
  siteId: z.string(),
  from: isoDateSchema,
  to: isoDateSchema,
  reports: z.array(dailyReportSchema),
})

export type Site = z.infer<typeof siteSchema>
export type WorkEntry = z.infer<typeof workEntrySchema>
export type DailyReport = z.infer<typeof dailyReportSchema>
export type DailyReportsQuery = z.infer<typeof dailyReportsQuerySchema>
export type DailyReportsResponse = z.infer<typeof dailyReportsResponseSchema>
export type SitesResponse = z.infer<typeof sitesResponseSchema>
