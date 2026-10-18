{{- define "foc-service.name" -}}
{{- required "name is required" .Values.name -}}
{{- end }}

{{- define "foc-service.image" -}}
{{- $registry := required "image.registry is required" .Values.image.registry -}}
{{- $name := required "image.name is required" .Values.image.name -}}
{{- $tag := required "image.tag is required" .Values.image.tag -}}
{{- printf "%s/%s:%s" $registry $name $tag -}}
{{- end }}

{{- define "foc-service.migrateImage" -}}
{{- printf "%s%s" (include "foc-service.image" .) .Values.migrate.tagSuffix -}}
{{- end }}

{{- define "foc-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "foc-service.name" . }}
{{- end }}

{{- define "foc-service.labels" -}}
{{ include "foc-service.selectorLabels" . }}
app.kubernetes.io/part-of: foc
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end }}

{{/* A mesh caller ("gateway" or a service name) as a Linkerd identityRef. */}}
{{- define "foc-service.meshCaller" -}}
{{- $root := index . 0 -}}
{{- $caller := index . 1 -}}
{{- if eq $caller "gateway" -}}
- kind: ServiceAccount
  name: {{ default (printf "envoy-%s" $root.Release.Namespace) $root.Values.mesh.gateway.serviceAccount }}
  namespace: {{ $root.Values.mesh.gateway.namespace }}
{{- else -}}
- kind: ServiceAccount
  name: {{ $caller }}
  namespace: {{ $root.Release.Namespace }}
{{- end -}}
{{- end }}
