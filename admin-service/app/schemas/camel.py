# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service request/response schemas under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

from pydantic import AliasGenerator, BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """JSON field names are camelCase. Python attributes stay snake_case so ORM rows still load."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=AliasGenerator(serialization_alias=to_camel),
    )
