# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-10-15
# Scope: Boilerplate/config assistance for Order Service under author-fixed requirements and architecture.
# Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

#!/bin/bash
# Send a default message.
#   bash /defaults/send.sh admin.review.started
#   bash /defaults/send.sh admin.case.resolved <order-uuid>
#   bash /defaults/send.sh UserDeleted <user-uuid>
set -euo pipefail

name="${1:-admin.review.started}"
id="${2:-00000000-0000-0000-0000-000000000000}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
file="${here}/messages/${name}.json"

case "$name" in
  admin.review.started|admin.case.resolved) topic="foc.admin.events" ;;
  order.status.changed) topic="foc.order.status" ;;
  credit.reservation.return|credit.reservation.release) topic="foc.credit.commands" ;;
  rating.permission.granted) topic="foc.rating.commands" ;;
  admin.escalation.opened) topic="foc.admin.commands" ;;
  UserDeleted) topic="foc.user.status" ;;
  *)
    echo "Unknown message: $name" >&2
    echo "Defaults:" >&2
    ls "${here}/messages" >&2
    exit 1
    ;;
esac

if [[ ! -f "$file" ]]; then
  echo "Missing $file" >&2
  exit 1
fi

event_id="$(cat /proc/sys/kernel/random/uuid)"
tr -d '\r\n' < "$file" \
  | sed -e "s/00000000-0000-0000-0000-000000000000/${id}/g" -e "s/EVENT_ID/${event_id}/g" \
  | sed "s/^/${id}:/" \
  | /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:29092 --topic "$topic" --property parse.key=true --property key.separator=:
echo "Sent $name to $topic for key $id"
