{{- define "foc-service.name" -}}
{{- required "name is required" .Values.name -}}
{{- end }}

{{- define "foc-service.image" -}}
{{- $registry := required "image.registry is required" .Values.image.registry -}}
{{- $name := required "image.name is required" .Values.image.name -}}
{{- $tag := required "image.tag is required" .Values.image.tag -}}
{{- printf "%s/%s:%s" $registry $name $tag -}}
{{- end }}

{{- define "foc-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "foc-service.name" . }}
{{- end }}

{{- define "foc-service.labels" -}}
{{ include "foc-service.selectorLabels" . }}
app.kubernetes.io/part-of: foc
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end }}
