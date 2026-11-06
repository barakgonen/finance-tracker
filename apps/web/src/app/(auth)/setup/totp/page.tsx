import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { appUser } from "@ft/db";
import { currentSession } from "@/lib/auth";
import { decryptSecret, encryptSecret, totp } from "@/lib/auth-core";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { messages } from "@/lib/i18n";
import { AuthForm } from "../../AuthForm";
import { confirmTotpAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TotpSetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.user.totpConfirmedAt) redirect(s.session.totpVerified ? "/" : "/login/verify");

  // the secret is created once and kept (encrypted) until enrollment is confirmed
  let secret: string;
  if (s.user.totpSecretEnc) {
    secret = decryptSecret(env.encryptionKey, s.user.totpSecretEnc);
  } else {
    secret = totp.generateSecret();
    await db().update(appUser).set({ totpSecretEnc: encryptSecret(env.encryptionKey, secret) }).where(eq(appUser.id, s.user.id));
  }
  const qr = await QRCode.toDataURL(totp.uri(s.user.email, secret), { margin: 1, width: 200 });
  const t = messages();
  return (
    <main className="auth">
      <div className="card">
        <h1>{t.auth.totpTitle}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.auth.totpHint}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code for the authenticator app" width={200} height={200} style={{ alignSelf: "center" }} />
        <p className="small" style={{ margin: 0 }}>
          {t.auth.totpManual} <code className="num" style={{ wordBreak: "break-all" }}>{secret}</code>
        </p>
        <AuthForm error={error} action={confirmTotpAction} submit={t.auth.confirm} errors={{ badCode: t.auth.badCode, locked: t.auth.locked, generic: t.errors.generic }}>
          <div className="field-group">
            <label htmlFor="code">{t.auth.code}</label>
            <input className="field num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required dir="ltr" />
          </div>
        </AuthForm>
      </div>
    </main>
  );
}
