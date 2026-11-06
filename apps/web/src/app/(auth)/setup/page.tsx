import { redirect } from "next/navigation";
import { messages } from "@/lib/i18n";
import { AuthForm } from "../AuthForm";
import { hasUsers } from "@/lib/auth";
import { setupAction } from "../actions";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await hasUsers()) redirect("/login");
  const t = messages();
  return (
    <main className="auth">
      <div className="card">
        <h1>{t.auth.setupTitle}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.auth.setupHint}</p>
        <AuthForm error={error} action={setupAction} submit={t.auth.create} errors={{ invalid: t.auth.invalid, generic: t.errors.generic }}>
          <div className="field-group">
            <label htmlFor="householdName">{t.auth.householdName}</label>
            <input className="field" id="householdName" name="householdName" required />
          </div>
          <div className="field-group">
            <label htmlFor="displayName">{t.auth.displayName}</label>
            <input className="field" id="displayName" name="displayName" required />
          </div>
          <div className="field-group">
            <label htmlFor="partnerName">{t.auth.partnerName}</label>
            <input className="field" id="partnerName" name="partnerName" />
          </div>
          <div className="field-group">
            <label htmlFor="email">{t.auth.email}</label>
            <input className="field" id="email" name="email" type="email" autoComplete="username" required dir="ltr" />
          </div>
          <div className="field-group">
            <label htmlFor="password">{t.auth.password} · {t.auth.passwordRule}</label>
            <input className="field" id="password" name="password" type="password" autoComplete="new-password" minLength={12} required dir="ltr" />
          </div>
        </AuthForm>
      </div>
    </main>
  );
}
