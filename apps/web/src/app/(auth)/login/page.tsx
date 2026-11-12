import { redirect } from "next/navigation";
import { messages } from "@/lib/i18n";
import { AuthForm } from "../AuthForm";
import { authLocale, hasUsers } from "@/lib/auth";
import { loginAction } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!(await hasUsers())) redirect("/setup");
  const t = messages(await authLocale());
  return (
    <main className="auth">
      <div className="card">
        <h1>{t.auth.loginTitle}</h1>
        <AuthForm error={error} action={loginAction} submit={t.auth.login} errors={{ badCredentials: t.auth.badCredentials, locked: t.auth.locked, generic: t.errors.generic }}>
          <div className="field-group">
            <label htmlFor="email">{t.auth.email}</label>
            <input className="field" id="email" name="email" type="email" autoComplete="username" required dir="ltr" />
          </div>
          <div className="field-group">
            <label htmlFor="password">{t.auth.password}</label>
            <input className="field" id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
          </div>
        </AuthForm>
      </div>
    </main>
  );
}
