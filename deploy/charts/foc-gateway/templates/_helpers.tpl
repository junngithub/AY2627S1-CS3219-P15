{{- define "foc-gateway.envoyServiceName" -}}
{{- .Values.envoyServiceName | default (printf "envoy-%s" .Release.Namespace) -}}
{{- end }}
