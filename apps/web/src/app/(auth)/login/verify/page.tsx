import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { messages } from "@/lib/i18n";
import { AuthForm } from "../../AuthForm";
import { verifyTotpAction } from "../../actions";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.user.totpConfirmedAt) redirect("/setup/totp");
  if (s.session.totpVerified) redirect("/");
  const t = messages();
  return (
    <main className="auth">
      <div className="card">
        <h1>{t.auth.verifyTitle}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.auth.verifyHint}</p>
        <AuthForm error={error} action={verifyTotpAction} submit={t.auth.verify} errors={{ badCode: t.auth.badCode, locked: t.auth.locked, generic: t.errors.generic }}>
          <div className="field-group">
            <label htmlFor="code">{t.auth.code}</label>
            <input className="field num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus dir="ltr" />
          </div>
        </AuthForm>
      </div>
    </main>
  );
}
