import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server only
const serverSupabase = createClient(supabaseUrl, supabaseServiceKey);

type ApiResponse = {
  ok?: boolean;
  error?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const payload = req.body || {};
    const experimentId = String(payload.experiment_id || "").trim();
    const questionId = String(payload.question_id || "").trim();
    const studentEmail = String(payload.student_email || "").trim().toLowerCase();

    if (!experimentId || !questionId || !studentEmail) {
      return res.status(400).json({ error: "Missing experiment_id, question_id, or student_email." });
    }

    const studentUserId = payload.student_user_id ?? null;

    const { data: existing, error: existingErr } = await serverSupabase
      .from("submissions")
      .select("id")
      .eq("experiment_id", experimentId)
      .eq("question_id", questionId)
      .eq("student_email", studentEmail)
      .maybeSingle();

    if (existingErr) {
      return res.status(500).json({ error: existingErr.message });
    }

    if (existing) {
      return res.status(409).json({ error: "This question has already been submitted by the student." });
    }

    const insertPayload = {
      experiment_id: experimentId,
      question_id: questionId,
      student_user_id: studentUserId,
      student_email: studentEmail,
      transcript: payload.transcript ?? "",
      audio_path: payload.audio_path ?? null,
      marks_awarded: Number.isFinite(Number(payload.marks_awarded))
        ? Number(payload.marks_awarded)
        : 0,
      mcq_choice:
        payload.mcq_choice === null || payload.mcq_choice === undefined
          ? null
          : Number(payload.mcq_choice),
    };

    const { error } = await serverSupabase.from("submissions").insert([insertPayload]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "unknown error" });
  }
}