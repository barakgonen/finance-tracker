import { headers } from "next/headers";
import { pendingInvitations } from "@ft/ingest";
import { householdScope, requireViewer } from "@/lib/auth";
import { date } from "@/lib/format";
import { scope } from "@/lib/db";
import { hebrewError } from "@/lib/errors";
import { messages } from "@/lib/i18n";
import { accounts, members } from "@/lib/queries";
import { addAccountAction, updateAccountAction } from "./actions";
import { addMemberAction, createInviteAction, revokeInviteAction } from "./invite-actions";

const INSTITUTIONS = [
  { id: "leumi", he: "בנק לאומי" },
  { id: "hapoalim", he: "בנק הפועלים" },
  { id: "discount", he: "בנק דיסקונט" },
  { id: "mizrahi", he: "מזרחי טפחות" },
  { id: "isracard", he: "ישראכרט" },
  { id: "cal", he: "כאל" },
  { id: "max", he: "מקס" },
  { id: "other", he: "אחר" },
];

type Account = Awaited<ReturnType<typeof accounts>>[number];
type Member = Awaited<ReturnType<typeof members>>[number];

function AccountFields({ a, people, banks, t }: { a?: Account; people: Member[]; banks: Account[]; t: ReturnType<typeof messages> }) {
  const id = a?.id ?? "new";
  const isCard = !a || a.type === "credit_card";
  return (
    <>
      <div className="grid">
        <div className="field-group">
          <label htmlFor={`name-${id}`}>{t.accounts.name}</label>
          <input className="field" id={`name-${id}`} name="name" defaultValue={a?.name} required />
        </div>
        {!a && (
          <div className="field-group">
            <label htmlFor="type-new">{t.accounts.type}</label>
            <select className="field" id="type-new" name="type" defaultValue="credit_card">
              {Object.entries(t.accountTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
        <div className="field-group">
          <label htmlFor={`inst-${id}`}>{t.accounts.institution}</label>
          <select className="field" id={`inst-${id}`} name="institution" defaultValue={a?.institution ?? "isracard"}>
            {INSTITUTIONS.map((i) => <option key={i.id} value={i.id}>{i.he}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor={`own-${id}`}>{t.accounts.owner}</label>
          <select className="field" id={`own-${id}`} name="ownerMemberId" defaultValue={a ? (a.ownerMemberId ?? "") : ""}>
            <option value="">{t.accounts.sharedOwner}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </div>
        {isCard && (
          <>
            <div className="field-group">
              <label htmlFor={`l4-${id}`}>{t.accounts.last4}</label>
              <input className="field num" id={`l4-${id}`} name="numberLast4" defaultValue={a?.numberLast4 ?? ""} inputMode="numeric" pattern="\d{4}" dir="ltr" />
            </div>
            <div className="field-group">
              <label htmlFor={`st-${id}`}>{t.accounts.settlesTo}</label>
              <select className="field" id={`st-${id}`} name="settlesToAccountId" defaultValue={a?.settlesToAccountId ?? ""}>
                <option value="">—</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field-group">
          <label htmlFor={`vis-${id}`}>{t.accounts.visibility}</label>
          <select className="field" id={`vis-${id}`} name="visibility" defaultValue={a?.visibility ?? "shared"}>
            <option value="shared">{t.accounts.visShared}</option>
            <option value="private">{t.accounts.visPrivate}</option>
          </select>
        </div>
      </div>
      {isCard && (
        <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
          <label className="check">
            <input type="checkbox" name="tracksStatements" defaultChecked={a?.tracksStatements ?? true} /> {t.accounts.tracks}
          </label>
          <span className="muted small">{t.accounts.tracksHint}</span>
          <div className="field-group">
            <label htmlFor={`pat-${id}`}>{t.accounts.pattern}</label>
            <input className="field" id={`pat-${id}`} name="billDescriptionPattern" defaultValue={a?.billDescriptionPattern ?? ""} placeholder='ישראכרט בע"מ' />
          </div>
        </div>
      )}
      {!isCard && <input type="hidden" name="tracksStatements" value="on" />}
    </>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; invite?: string; member?: string }>;
}) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const { error, saved, invite, member: invitedMemberId } = await searchParams;
  const [people, accts, invites] = await scope(householdScope(viewer), async (tx) => [
    await members(tx, viewer.householdId),
    await accounts(tx, viewer.householdId),
    viewer.role === "admin" ? await pendingInvitations(tx, viewer.householdId) : [],
  ] as const);
  const isAdmin = viewer.role === "admin";
  let inviteLink: string | null = null;
  if (invite && isAdmin) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") || h.get("host")?.startsWith("127.") ? "http" : "https");
    inviteLink = `${proto}://${h.get("host")}/invite/${encodeURIComponent(invite)}`;
  }
  const banks = accts.filter((a) => a.type === "bank");
  const readOnly = viewer.role === "viewer";
  const ownerName = (id: string | null) => people.find((p) => p.id === id)?.displayName ?? t.accounts.sharedOwner;

  return (
    <>
      <h1>{t.accounts.title}</h1>
      {error && <div role="alert" className="banner warn">{hebrewError(error)}</div>}
      {saved && <div role="status" className="banner ok">{t.accounts.saved}</div>}

      {inviteLink && (
        <div role="status" className="banner ok">
          <div className="stack" style={{ "--gap": "6px", minInlineSize: 0 } as React.CSSProperties}>
            <strong>{t.invite.linkTitle.replace("{name}", people.find((p) => p.id === invitedMemberId)?.displayName ?? "")}</strong>
            <code className="num" data-invite-link style={{ wordBreak: "break-all", userSelect: "all" }}>{inviteLink}</code>
            <span className="small">{t.invite.linkHint}</span>
          </div>
        </div>
      )}

      <section className="card stack">
        <h2>{t.accounts.members}</h2>
        {people.map((p) => (
          <div key={p.id} className="stack" style={{ "--gap": "8px", borderBlockEnd: "1px solid var(--row-line)", paddingBlockEnd: 12 } as React.CSSProperties}>
            <div className="row spread">
              <strong>{p.displayName}</strong>
              <span className="chip">{t.roles[p.role]} · {p.userId ? t.invite.hasLogin : t.invite.noLogin}</span>
            </div>
            {isAdmin && !p.userId && (
              <form action={createInviteAction} className="row" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="memberId" value={p.id} />
                <div className="field-group" style={{ flex: "2 1 220px" }}>
                  <label htmlFor={`inv-email-${p.id}`}>{t.invite.emailOptional}</label>
                  <input className="field" id={`inv-email-${p.id}`} name="email" type="email" dir="ltr" />
                </div>
                <div className="field-group" style={{ flex: "1 1 140px" }}>
                  <label htmlFor={`inv-role-${p.id}`}>{t.invite.role}</label>
                  <select className="field" id={`inv-role-${p.id}`} name="role" defaultValue="member">
                    {(["member", "viewer", "admin"] as const).map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}
                  </select>
                </div>
                <button className="btn" type="submit">{t.invite.create}</button>
              </form>
            )}
          </div>
        ))}
        {isAdmin && invites.length > 0 && (
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <h2 style={{ fontSize: 15 }}>{t.invite.pending}</h2>
            {invites.map((i) => (
              <form key={i.id} action={revokeInviteAction} className="row spread small">
                <input type="hidden" name="invitationId" value={i.id} />
                <span>
                  {people.find((p) => p.id === i.memberId)?.displayName} · {t.roles[i.role]} · {t.invite.expires} <span className="num">{date(i.expiresAt.toISOString().slice(0, 10))}</span>
                </span>
                <button className="btn" type="submit">{t.invite.revoke}</button>
              </form>
            ))}
          </div>
        )}
        {isAdmin && (
          <form action={addMemberAction} className="row" style={{ alignItems: "flex-end" }}>
            <div className="field-group" style={{ flex: "1 1 240px" }}>
              <label htmlFor="new-member">{t.invite.addMember}</label>
              <input className="field" id="new-member" name="displayName" required placeholder={t.invite.memberName} />
            </div>
            <button className="btn" type="submit">{t.invite.add}</button>
          </form>
        )}
      </section>

      <section className="card stack">
        <h2>{t.accounts.list}</h2>
        {accts.map((a) => (
          <details key={a.id} className="stack" style={{ borderBlockEnd: "1px solid var(--row-line)", paddingBlock: 12 }}>
            <summary className="row spread" style={{ cursor: "pointer", minBlockSize: 44 }}>
              <span className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
                <strong>{a.name}{a.numberLast4 ? <span className="num"> •••• {a.numberLast4}</span> : null}</strong>
                <span className="muted small">{t.accountTypes[a.type]} · {ownerName(a.ownerMemberId)}</span>
              </span>
              <span className="row" style={{ "--gap": "6px" } as React.CSSProperties}>
                {a.type === "credit_card" && (a.tracksStatements ? <span className="chip ok">דוחות מיובאים</span> : <span className="chip">לא מפורט</span>)}
                {a.visibility === "private" && <span className="chip">פרטי</span>}
              </span>
            </summary>
            {!readOnly && (
              <form action={updateAccountAction} className="stack" style={{ paddingBlockStart: 12 }}>
                <input type="hidden" name="accountId" value={a.id} />
                <AccountFields a={a} people={people} banks={banks} t={t} />
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn primary" type="submit">{t.accounts.save}</button>
                </div>
              </form>
            )}
          </details>
        ))}
      </section>

      {!readOnly && (
        <form action={addAccountAction} className="card stack">
          <h2>{t.accounts.add}</h2>
          <AccountFields people={people} banks={banks} t={t} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit">{t.accounts.add}</button>
          </div>
        </form>
      )}
    </>
  );
}
