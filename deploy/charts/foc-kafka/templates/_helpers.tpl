{{/* Label that ties a node pool / topic / user to the Kafka cluster. */}}
{{- define "foc-kafka.clusterLabel" -}}
strimzi.io/cluster: {{ .Values.clusterName }}
{{- end }}
