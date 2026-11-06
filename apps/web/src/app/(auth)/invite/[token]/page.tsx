import { findInvitation, hashInviteToken } from "@ft/ingest";
import { scope } from "@/lib/db";
import { messages } from "@/lib/i18n";
import { AuthForm } from "../../AuthForm";
import { acceptInviteAction } from "../actions";

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token: raw } = await params;
  const { error } = await searchParams;
  const token = decodeURIComponent(raw);
  const t = messages();
  const invite = /^[A-Za-z0-9_-]{20,100}$/.test(token)
    ? await scope({ inviteTokenHash: hashInviteToken(token) }, (tx) => findInvitation(tx, token))
    : null;

  if (!invite) {
    return (
      <main className="auth">
        <div className="card">
          <div role="alert" className="banner error">{t.invite.invalid}</div>
        </div>
      </main>
    );
  }
  return (
    <main className="auth">
      <div className="card">
        <h1>{t.invite.acceptTitle.replace("{household}", invite.householdName)}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.invite.acceptHint.replace("{member}", invite.memberName)}</p>
        <AuthForm
          action={acceptInviteAction}
          error={error}
          submit={t.invite.accept}
          errors={{ invalid: t.invite.invalid, email_taken: t.invite.emailTaken, invalid_form: t.auth.invalid, generic: t.errors.generic }}
        >
          <input type="hidden" name="token" value={token} />
          <div className="field-group">
            <label htmlFor="displayName">{t.auth.displayName}</label>
            <input className="field" id="displayName" name="displayName" defaultValue={invite.memberName} required />
          </div>
          <div className="field-group">
            <label htmlFor="email">{t.auth.email}</label>
            <input className="field" id="email" name="email" type="email" defaultValue={invite.email ?? ""} autoComplete="username" required dir="ltr" />
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
