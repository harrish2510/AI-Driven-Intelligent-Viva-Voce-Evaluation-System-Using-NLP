// src/pages/api/proctor-event.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const serverSupabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { experiment_id, student_user_id, student_email, event_type, details } = req.body;
    const payload: any = {
      experiment_id: experiment_id || null,
      student_user_id: student_user_id || null,
      student_email: student_email || null,
      event_type,
      details: details ? details : {}
    };
    const { error } = await serverSupabase.from("proctor_events").insert([payload]);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "unknown error" });
  }
}