import sys
from pathlib import Path

import pytest

# 把 backend 目录加入 sys.path：项目源码统一用 src.* 绝对导入，
# pytest 不像 langgraph dev 会自动注入该路径，这里补齐保持导入方式一致
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
