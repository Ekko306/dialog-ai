from langchain_anthropic import ChatAnthropic

model = ChatAnthropic(
    model= "glm-5.3-flash" , # 注意：去掉CC配置里的 [1M] 后缀，那是Claude Code专用的上下文标记
    timeout= 60 ,
    # GLM-5.3/5.3-FLASH 是强制思考模型：thinking.type=disabled 会被服务端 400 拒绝，只能调低思考程度
    thinking={"type": "enabled"},
    # 智谱官方控制思考深度的参数：GLM-5.3 系仅支持 max/high/low，low=轻度推理
    # langchain-anthropic 无 extra_body 字段，经 model_kwargs 透传进请求体顶层
    model_kwargs={"extra_body": {"reasoning_effort": "low"}},
)