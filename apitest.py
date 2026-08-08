import os

from google import genai


api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
if not api_key:
    raise SystemExit("Set GEMINI_API_KEY in your environment before running this test.")

client = genai.Client(api_key=api_key)

print("Gemini API Test")
print("----------------")

try:
    user_input = input("Enter your agriculture question: ")
    response = client.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", "gemini-3.6-flash"),
        contents=user_input,
    )
    print("\nResponse:")
    print(response.text)
    print("\nGemini API key is working.")
except Exception as error:
    print("\nGemini API error:")
    print(error)
