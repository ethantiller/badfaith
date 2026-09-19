from pydantic import BaseModel


class Article(BaseModel):
	outlet: str
	url: str
	headline: str
	snippet: str
	seendate: str