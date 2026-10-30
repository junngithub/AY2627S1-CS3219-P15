from pydantic import AliasGenerator, BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """JSON field names are camelCase. Python attributes stay snake_case so ORM rows still load."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=AliasGenerator(serialization_alias=to_camel),
    )
