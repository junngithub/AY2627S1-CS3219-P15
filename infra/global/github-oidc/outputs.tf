output "ci_role_arn" {
  description = "GitHub repo variable AWS_ROLE_ARN."
  value       = aws_iam_role.ci.arn
}

output "ci_role_name" {
  value = aws_iam_role.ci.name
}
