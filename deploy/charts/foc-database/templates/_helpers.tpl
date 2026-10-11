{{/* Database and login name for a service: <env>_<service>. */}}
{{- define "foc-database.dbName" -}}
{{- printf "%s_%s" (required "env is required" .env) .service -}}
{{- end }}

{{/* Locked-down pod and container settings shared by the Job and tests. */}}
{{- define "foc-database.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 70 # postgres in postgres:*-alpine
{{- end }}
