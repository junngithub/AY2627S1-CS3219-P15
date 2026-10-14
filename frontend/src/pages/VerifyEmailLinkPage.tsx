import { Navigate, useSearchParams } from 'react-router-dom';

// Older email-link routes now lead to the OTP form rather than submitting a token.
export function VerifyEmailLinkPage() {
  const [params] = useSearchParams();
  return <Navigate to="/verify-email" replace state={{ email: params.get('email') ?? undefined }} />;
}
