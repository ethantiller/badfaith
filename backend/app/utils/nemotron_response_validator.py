import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)

def validate(response: str, actual_paragraphs: str) -> bool:
    try:
        response_data = json.loads(response)
    except json.JSONDecodeError:
        logging.error("Failed to decode JSON")
        return False

    try:
        actual_data = json.loads(actual_paragraphs)
    except json.JSONDecodeError:
        actual_data = None

    claims = response_data.get("claims", [])

    nemotron_quotes = []
    for claim in claims:
        nemotron_quotes.append(claim["quote"])

    if isinstance(actual_data, dict):
        actual_quotes = [
            paragraph["text"]
            for paragraph in actual_data.get("paragraphs", [])
        ]
    else:
        actual_quotes = [actual_paragraphs]

    for quote in nemotron_quotes:
        if not any(quote in paragraph for paragraph in actual_quotes):
            return False

    return True

test_response = Path("C:\\Users\\wenxi\\Desktop\\Git\\badfaith\\backend\\app\\utils\\test_response.json")
test_article = Path("C:\\Users\\wenxi\\Desktop\\Git\\badfaith\\backend\\app\\utils\\test_article.txt")

test_validation = validate(
        test_response.read_text(encoding="utf-8"),
        test_article.read_text(encoding="utf-8"),
)
print(f"Validation result: {test_validation}")