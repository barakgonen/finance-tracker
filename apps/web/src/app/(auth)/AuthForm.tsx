/** A plain server-action form (works without JavaScript) that shows the error passed back in the URL. */
export function AuthForm({
  action,
  error,
  errors,
  submit,
  children,
}: {
  action: (form: FormData) => Promise<void>;
  error?: string;
  errors: Record<string, string>;
  submit: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action} className="stack">
      {error && (
        <div role="alert" className="banner error">
          {errors[error] ?? errors.generic}
        </div>
      )}
      {children}
      <button className="btn primary" type="submit">
        {submit}
      </button>
    </form>
  );
}
