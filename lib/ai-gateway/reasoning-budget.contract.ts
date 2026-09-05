/**
 * Kontrak observasi reasoning/output-cap. Metadata murni: hitungan token dan
 * boolean keberadaan field saja. Isi reasoning maupun prosa model TIDAK PERNAH
 * melewati seam ini, sehingga kebijakan retensi diagnostic tetap utuh.
 *
 * Tujuannya membedakan dua kegagalan yang terlihat identik dari luar: model
 * yang gagal merespons, versus model reasoning yang menghabiskan output cap
 * untuk berpikir sehingga prosa terlihat kosong oleh parser.
 */
export type ObservedReasoningBudget = Readonly<{
  /** `outputTokenDetails.reasoningTokens`; null bila provider tidak melaporkan. */
  reasoningTokenCount: number | null
  /** True bila final step memuat field reasoning apa pun (teks tidak dibaca). */
  reasoningFieldPresent: boolean
  /** True bila final step memuat reasoning parts terstruktur. */
  reasoningDetailsPresent: boolean
  /** Panjang teks model-visible setelah trim; 0 berarti parser akan menolak. */
  visibleContentChars: number
  /** `usage.outputTokens` mentah, tanpa rekonsiliasi total. */
  completionTokenCount: number | null
  finishReason: string | undefined
}>
