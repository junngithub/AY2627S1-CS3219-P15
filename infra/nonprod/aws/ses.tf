# user-service's sender: one email address (no custom domain, so no DKIM).
# After apply, SES emails that address a verification link: click it, or
# sending fails with MessageRejected. New accounts start in the SES sandbox:
# only verified recipients and 200 emails a day. Verify testers' addresses in
# the console, or request production access before real users sign up.
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.ses_from_email
}
