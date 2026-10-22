{{- define "foc-gateway.envoyServiceName" -}}
{{- .Values.envoyServiceName | default (printf "envoy-%s" .Release.Namespace) -}}
{{- end }}

{{- define "foc-gateway.envoyServiceAccountName" -}}
{{- .Values.envoyServiceAccountName | default (printf "envoy-%s" .Release.Namespace) -}}
{{- end }}
