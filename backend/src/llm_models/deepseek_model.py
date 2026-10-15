from langchain_deepseek import ChatDeepSeek

# DEEPSEEK_API_KEY=

model = ChatDeepSeek(
    model = "deepseek-v4-flash",
    extra_body=
    {
        "thinking":{
            "type":"disabled"
        }
    }
)