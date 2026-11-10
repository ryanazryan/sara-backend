import { Resend } from "resend";

export async function sendVerificationCode(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !sender) throw new Error("Resend sender/API key is not configured");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: sender,
    to,
    subject: "Verifikasi email SARA",
    text: `Kode verifikasi SARA Anda: ${code}\nKode berlaku 5 menit.\nAbaikan jika Anda tidak membuat akun SARA.`,
  });
  if (error) throw new Error("Resend rejected verification email");
}
