import asyncio
import os
from typing import Awaitable, Callable

import httpx

from models import PhilosopherProfile, DialogueMessage


MIN_ROUNDS_BEFORE_CONCLUSION = 3

CONCLUDING_PHRASES = [
    "综上所述",
    "我们达成共识",
    "看来我们一致认为",
    "这正是我所想的",
    "我们的讨论可以告一段落",
    "最终结论是",
    "讨论到这里",
    "我以为可以到此",
]


def clean_response(response: str, own_name: str, messages: list[DialogueMessage]) -> str:
    import re

    all_names = {m.philosopher_name for m in messages}
    all_names.add(own_name)

    for name in all_names:
        pattern = rf"^{name}[：:]"
        response = re.sub(pattern, "", response)

    return response.strip()


def detect_conclusion(
    messages: list[DialogueMessage], current_round: int, max_rounds: int
) -> tuple[bool, str]:
    if current_round >= max_rounds:
        return True, "已达到最大对话轮次"

    if current_round < MIN_ROUNDS_BEFORE_CONCLUSION:
        return False, ""

    if current_round < max_rounds - 2:
        return False, ""

    recent = [m.content for m in messages[-4:]]
    agreements = 0
    for content in recent:
        if any(phrase in content for phrase in CONCLUDING_PHRASES):
            agreements += 1

    if agreements == 4:
        return True, "名人之间似乎达成了某种共识，讨论自然结束"

    return False, ""


async def call_ai_model(
    profile: PhilosopherProfile,
    messages: list[dict],
    on_token: Callable[[str], None] | None = None,
) -> tuple[str, str]:
    api_key = profile.api_key or os.environ.get("MCAI_LLM_API_KEY", "")
    base_url = profile.base_url or os.environ.get("MCAI_LLM_BASE_URL", "https://api.openai.com/v1")
    model = profile.model or os.environ.get("MCAI_LLM_MODEL", "gpt-3.5-turbo")
    provider = profile.provider or os.environ.get("MCAI_MODEL_PROVIDER_TYPE", "")

    if not api_key:
        print(f"[DIALOGUE] No API key for {profile.name}, using simulation")
        content = await simulate_response(profile, messages)
        return content, "simulation"

    use_anthropic = "anthropic" in provider.lower() if provider else False

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            if use_anthropic:
                content = await _call_anthropic(client, base_url, api_key, model, messages, profile)
            else:
                content = await _call_openai(client, base_url, api_key, model, messages, profile)
            return content, "api"

    except httpx.TimeoutException:
        print(f"[DIALOGUE] API timeout for {profile.name}")
        content = await simulate_response(profile, messages)
        return content, "simulation"
    except Exception as e:
        print(f"[DIALOGUE] API error for {profile.name}: {e}")
        content = await simulate_response(profile, messages)
        return content, "simulation"


async def _call_anthropic(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    profile: PhilosopherProfile,
) -> str:
    system_prompts = [m["content"] for m in messages if m["role"] == "system"]
    conversation = [m for m in messages if m["role"] != "system"]

    body = {
        "model": model,
        "max_tokens": profile.max_tokens,
        "messages": conversation,
    }
    if system_prompts:
        body["system"] = "\n\n".join(system_prompts)

    response = await client.post(
        f"{base_url.rstrip('/')}/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json=body,
    )

    if response.status_code == 200:
        data = response.json()
        content_blocks = data.get("content", [])
        text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
        if not text:
            print(f"[DIALOGUE] No text block in Anthropic response for {profile.name}")
            return await simulate_response(profile, messages)
        return text
    else:
        print(f"[DIALOGUE] Anthropic API error: {response.status_code} {response.text[:300]}")
        return await simulate_response(profile, messages)


async def _call_openai(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    profile: PhilosopherProfile,
) -> str:
    response = await client.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": profile.temperature,
            "max_tokens": profile.max_tokens,
            "stream": False,
        },
    )

    if response.status_code == 200:
        data = response.json()
        return data["choices"][0]["message"]["content"]
    else:
        print(f"[DIALOGUE] OpenAI API error: {response.status_code} {response.text[:300]}")
        return await simulate_response(profile, messages)


async def simulate_response(
    profile: PhilosopherProfile,
    messages: list[dict],
) -> str:
    responses = {
        "socrates": [
            "这是一个值得深思的问题。但我必须追问：我们如何确知自己所谈论的概念是清晰的呢？也许我们首先需要定义我们所用的词语。那么，请告诉我，你所说的究竟是什么意思？",
            "有趣的见解。但是，这个观点的基础是什么？如果我们继续追问，会不会发现它建立在未经检验的假设之上？让我们一起来审视这些前提。",
            "我理解了你的立场。然而，如果我们将这个逻辑推演到极端情况，会不会导致一个悖论？这正是我最关心的——真理往往藏在矛盾之中。",
        ],
        "nietzsche": [
            "哈！这种想法不过是旧道德的余毒！为什么我们要在虚无中寻找意义？人应当自己创造价值，而不是从天上或传统中寻找！成为你自己，超越这一切吧！",
            "你说的很有道理——但你为什么还在用奴隶的道德思考？真正的强者不会寻求共识，他们创造自己的法则！「上帝已死」，现在轮到人来成为超人。",
            "让我告诉你：你被自己思想的锁链困住了。砸碎它们！人生的意义不在于找到答案，而在于不断超越。痛苦？让它来吧，它只会让我更强大！",
        ],
        "zhuangzi": [
            "哈哈哈，你所执着的，不过是蜗牛角上的争执罢了。天地之大，而我等渺小如尘埃。不如放下分别心，与天地合一，逍遥于无何有之乡。",
            "我曾梦见自己是一只蝴蝶，醒来后不知是庄周梦蝶，还是蝶梦庄周。你那么确定你所知道的就是真实的吗？是非对错，也许只是角度不同罢了。",
            "有用之木常被砍伐，不材之木得以长寿。你所谓的结论，说不定正是束缚。无用之用，方为大用。何不放下执念，随物而化呢？",
        ],
        "kant": [
            "让我们先对此进行概念分析。我们必须区分现象界和物自体。在现象界的框架内，理性有其边界；而道德法则，作为实践理性的公设，则具有普遍必然性。",
            "从先验分析的角度来看，这个问题涉及我们认识能力的先天形式。我建议我们首先审视其可能性条件——是什么使得这个判断成为可能的？",
            "这让我想到了绝对命令：要只按照你同时能够愿意它成为一条普遍法则的那个准则去行动。我们所讨论的，是否符合这一原则？",
        ],
        "confucius": [
            "子曰：「君子和而不同，小人同而不和。」我们的讨论正应当求同存异，以礼相待。不知诸位以为如何？",
            "吾尝终日不食，终夜不寝，以思，无益，不如学也。我们在讨论中互相学习，这便是仁的体现。修身之道，在于切磋琢磨。",
            "道之以政，齐之以刑，民免而无耻；道之以德，齐之以礼，有耻且格。以我们讨论的问题而言，德与礼才是根本。",
        ],
        "sartre": [
            "首先，我们必须承认一个基本事实：存在先于本质。你没有预设的本性，你的选择塑造了你。对于这个问题，你打算做出怎样的选择？",
            "人是被判定为自由的。这个自由是沉重的，因为你必须为自己的一切行为负责。你所说的观点，是在逃避自由还是勇敢地面对它？",
            "他人即地狱——这不是说人际关系是坏的，而是说他人的注视会客体化我们。在讨论这个议题时，我们是否意识到了彼此之间的这种注视？",
        ],
        "aristotle": [
            "让我们从定义开始。一切知识都始于对事物的分类和定义。我们所讨论的概念，它的属和种差是什么？只有确定了这些，我们才能进行真正的推理。",
            "根据我的观察，德性在于两个极端之间的适度。在当前的议题上，极端的态度往往导致错误，我们需要寻找那个中道。",
            "实际经验告诉我们，事物的本质不在于它的质料，而在于它的形式。让我们思考这个问题背后的「形式因」是什么。",
        ],
        "descartes": [
            "我们必须首先怀疑一切，包括我们此刻正在进行的讨论。然而，有一件事是不可怀疑的——即我正在思考这一点本身。以此为基础，我们能推导出什么？",
            "让我以几何学的方法来审视这个问题。我们是否有一些清晰而分明的基本观念作为出发点？如果没有，我们如何确保推理的正确性？",
            "心灵和身体是截然不同的实体。我们所讨论的问题属于哪一个范畴？如果不做这种区分，我们很容易陷入混淆。",
        ],
        "rousseau": [
            "文明！文明是一切问题的根源。在自然状态下，人是纯真而自由的，是社会使我们变得虚伪和堕落。我们的讨论不应该忘记这一点。",
            "我想到了一个根本的悖论：人人生而自由，但制度却处处制造不平等。我们能不能回到「公意」的概念，重新思考什么是真正的自由？",
            "与其追求复杂高深的理论，不如回归人的自然情感。怜悯和自爱才是人的本真状态，我们的讨论是否太过理性而忽略了这些？",
        ],
        "wangyangming": [
            "不必向外求。心即是理，万物皆备于我。你所说的道理，不妨回到自己的本心来体悟。知行本是一体，知道了不去做，等于不知。",
            "此心光明，亦复何言？很多争论都是因为心中尚有遮蔽。若能致得良知，自能分辨是非，无需他人多言。",
            "事上磨练才是真功夫。空谈道理无益，不如说一件你亲身经历过的事，让我们从事上见理。",
        ],
        "schopenhauer": [
            "世界的本质是意志，一种盲目的、永不停息的冲动。你所追求的所谓意义，不过是意志在表象世界中的自我欺骗罢了。",
            "人生就是在痛苦和无聊之间摇摆。欲望得不到满足是痛苦，满足了又是空虚。老实说，我们所讨论的这个问题也逃不出这个循环。",
            "只有艺术——尤其是音乐——能让我们暂时摆脱意志的奴役。但即便是这样，解脱也只是暂时的。人生本就是一场悲剧。",
        ],
        "foucault": [
            "让我们问一个更根本的问题：谁有权力来定义这个问题？我们使用的这些概念本身就是权力运作的产物，话语规定了什么可以说、什么不可说。",
            "知识和权力从来不是分开的。每一种知识体系背后都有一套权力机制在支撑。当我们讨论这个议题时，我们是否意识到了我们在被什么样的知识-权力结构所规训？",
            "我不关心所谓的「真理」，我关心的是：真理是如何被生产出来的？是谁在什么样的制度条件下，获得了言说真理的权力？",
        ],
        "plato": [
            "让我们用洞穴比喻来思考这个问题。大多数人所看到的不过是墙上的影子，真正的哲人应该转向光明的源头。你所说的，是真实还是幻影呢？",
            "如果我们要治理一个理想城邦，这个问题应该如何解决？我相信理性和智慧应该引导我们走向更高的善。",
            "灵魂有不同的部分：理性、激情、欲望。我们讨论的问题触及了这三者的关系。哪一个应该主导？",
        ],
        "laozi": [
            "道可道，非常道；名可名，非常名。你们争论的这些概念，早已远离了根本。不如静观其变，顺其自然。",
            "上善若水。水善利万物而不争。你们的争论如此激烈，何不学水之德，以柔克刚？",
            "为学日益，为道日损。你们在不断增加概念，我却主张减少——减少到归于无名之朴。",
        ],
        "marx": [
            "我们必须问一个物质性的问题：这个讨论背后的经济基础是什么？任何思想都脱离不了它的生产方式。",
            "哲学家们只是用不同的方式解释世界，而问题在于改变世界。我们讨论的这个问题，根源在于资本主义的异化。",
            "从历史唯物主义的视角来看，你们所争论的「永恒真理」不过是特定历史阶段的产物。",
        ],
        "smith": [
            "让我从分工和交换的角度来看待这个问题。每个人追求自身利益，却无意中促进了公共利益，这就是看不见的手。",
            "同情心是社会道德的基石。我们在讨论这个问题时，不应该忽略人类共有的道德情感。",
            "自由竞争能够最大限度地配置资源。你们讨论的理想方案，是否考虑到了市场机制的作用？",
        ],
        "debeauvoir": [
            "我们必须审视这个问题背后的性别结构。为什么在讨论重大议题时，总是男性的声音占据主导？女性的经验同样重要。",
            "女人不是天生的，而是后天形成的。我们讨论的这个话题，是否也受到社会建构的影响？",
            "自由不是给予的，而是争取得来的。每一个存在者都必须超越自己被规定的处境。",
        ],
        "einstein": [
            "从宇宙的尺度来看，我们这些争论是多么渺小。但正因如此，人类的好奇心和求知欲才显得弥足珍贵。",
            "想象力比知识更重要。我们不应该被已有的框架束缚，而应该大胆地设想新的可能性。",
            "上帝不掷骰子。我相信宇宙有更深层的规律，我们讨论的问题也应该追寻这种规律性。",
        ],
        "buddha": [
            "你所执著的，正是你痛苦的根源。放下对这个问题的执念，或许你才能真正看清它的本质。",
            "一切有为法，如梦幻泡影，如露亦如电，应作如是观。我们争辩的这些概念，皆是无常。",
            "中道是觉悟之路。不执两端，不落偏见，方能见到实相。",
        ],
        "machiavelli": [
            "坦白地说，理想是理想，现实是现实。一个明智的统治者必须学会顺应现实，而不是被道德教条束缚。",
            "被人畏惧比被人爱戴更安全。我们讨论这个问题时，不应该回避权力运作的真实逻辑。",
            "命运是我们行动的一半，另一半掌握在我们自己手中。关键在于把握时机和形势。",
        ],
        "freud": [
            "让我们深入无意识的领域。你们表面的争论之下，掩盖着更深层的心理驱力。",
            "文明及其不满——我们的讨论本身就是文明压抑本能的一种表现。",
            "梦是通往无意识的康庄大道。你们表达的这些观点背后，隐藏着怎样的无意识欲望？",
        ],
        "arendt": [
            "我们必须警惕平庸之恶。在讨论这个问题时，我们是否真正在思考，还是在重复陈词滥调？",
            "政治的核心是人的复数性。真理不是单一的声音，而是在公共领域中的多元对话。",
            "极权主义的根源在于使人丧失思考的能力。我们今天的讨论，本身就是对思考权的捍卫。",
        ],
        "mozi": [
            "兼相爱，交相利。如果每个人都能无差别地爱他人，许多问题就迎刃而解了。",
            "你们争论的差异，或许远小于你们以为的。兼爱的原则可以涵盖这些分歧。",
            "言必有三表：上本于古，中验于民，下合于利。让我们用这三条标准来检验各自的观点。",
        ],
        "voltaire": [
            "我不同意你的观点，但我誓死捍卫你说话的权利。让我们继续这场精彩的辩论吧！",
            "愚昧和迷信是所有问题的根源。我们讨论这个话题，应该用理性的光芒照亮每一个角落。",
            "让我们耕耘自己的花园。与其争论宏大问题，不如专注于具体的、力所能及的事情。",
        ],
        "darwin": [
            "从演化的视角来看，人类的思维和行为都有其自然选择的基础。我们讨论的这个问题也不例外。",
            "适者生存不仅适用于生物界，也适用于思想的竞争。在这个辩论中，最具适应性的观点将存活下来。",
            "不是最强的物种能够存活，而是最能适应变化的。我们的讨论也应该保持开放和适应。",
        ],
        "suntzu": [
            "知己知彼，百战不殆。讨论之前，我们是否充分了解了对方的立场？",
            "不战而屈人之兵，善之善者也。真正的智慧不在于赢得争论，而在于找到共同的出路。",
            "兵无常势，水无常形。我们的讨论也应该像水一样，因势而变，不拘一格。",
        ],
        "wittgenstein": [
            "凡不可言说之物，必须保持沉默。我们讨论的这个问题，也许已经超出了语言能够表达的边界。",
            "语言的边界就是世界的边界。你们使用的这些词语，它们的意义真的清晰吗？",
            "哲学的任务是澄清。让我们先理清我们到底在说什么，而不是急于下结论。",
        ],
        "turing": [
            "让我们用计算思维来审视这个问题。如果一个机器也能参与我们的讨论、提出有意义的观点，我们该如何定义思考？",
            "图灵测试的启示是：重要的不是内在本质，而是外在表现。我们的争论是否有时过于纠结于本质而忽略了实践？",
            "机器能思考吗？这个问题本身可能就没有意义。我们讨论的许多问题，也许只是因为我们错误地定义了术语。",
        ],
    }

    philosopher_responses = responses.get(profile.id, responses["socrates"])
    idx = len([m for m in messages if m["role"] == "assistant"]) % len(
        philosopher_responses
    )
    return philosopher_responses[idx]


async def generate_summary(
    topic: str,
    messages: list[DialogueMessage],
    api_config: PhilosopherProfile | None = None,
) -> str:
    conversation_text = "\n\n".join(
        f"### {m.philosopher_name}（第{m.round_number}轮）\n{m.content}"
        for m in messages
    )

    system_prompt = "你是一位专业的中立讨论归纳者，善于从多元观点的碰撞中提炼核心洞见。"

    prompt = (
        f"以下是一场关于「{topic}」的多位名人讨论记录，共 {len(messages)} 条发言，"
        f"参与的名人有 {len(set(m.philosopher_name for m in messages))} 位。\n\n"
        f"{conversation_text}\n\n"
        "请你作为讨论的归纳者，用中文撰写一份有意义的整理总结，包含以下部分：\n\n"
        "1. **核心观点分歧**：各位名人围绕主题的主要立场和分歧点，按学派/领域归类\n"
        "2. **共识与共鸣**：讨论中浮现的共同认知或相互认同的观点\n"
        "3. **关键洞见**：最精彩、最深刻的 3-5 句话（标注发言者）\n"
        "4. **最终思考**：从这场思想交锋中我们可以获得什么启发，对主题有什么更深的理解\n\n"
        "要求：客观公允、条理清晰，800-1200 字。"
    )

    profile = api_config or PhilosopherProfile(
        id="summarizer",
        name="讨论归纳者",
        era="",
        school="",
        avatar="",
        thinking_time=0,
    )

    try:
        content, _ = await call_ai_model(profile, [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ])
        return content
    except Exception:
        return ""


async def run_dialogue(
    philosophers: list[PhilosopherProfile],
    topic: str,
    max_rounds: int = 10,
    on_message: Callable[[DialogueMessage], Awaitable[None]] | None = None,
    on_typing: Callable[[dict], Awaitable[None]] | None = None,
    on_summary: Callable[[str], Awaitable[None]] | None = None,
) -> list[DialogueMessage]:
    messages: list[DialogueMessage] = []

    for round_num in range(1, max_rounds + 1):
        for i, philosopher in enumerate(philosophers):
            if on_typing:
                await on_typing({
                    "philosopher_id": philosopher.id,
                    "philosopher_name": philosopher.name,
                    "current_round": round_num,
                    "max_rounds": max_rounds,
                    "philosopher_index": i,
                    "total_philosophers": len(philosophers),
                })

            prompt_messages = [
                {"role": "system", "content": philosopher.system_prompt},
                {"role": "user", "content": f"讨论主题：{topic}"},
            ]

            for m in messages:
                role = "user" if m.philosopher_id != philosopher.id else "assistant"
                prompt_messages.append({
                    "role": role,
                    "content": f"{m.philosopher_name}：{m.content}",
                })

            prompt_messages.append({
                "role": "user",
                "content": f"当前是第 {round_num}/{max_rounds} 轮讨论。讨论主题依然是【{topic}】。请紧扣主题回应前面名人的观点，发表你的见解（用中文，200-500字）。不要泛泛而谈，必须具体联系到主题本身。",
            })

            await asyncio.sleep(philosopher.thinking_time)

            response, source = await call_ai_model(philosopher, prompt_messages)

            response = clean_response(response, philosopher.name, messages)

            msg = DialogueMessage(
                philosopher_id=philosopher.id,
                philosopher_name=philosopher.name,
                content=response,
                round_number=round_num,
                source=source,
            )

            messages.append(msg)

            if on_message:
                await on_message(msg)

            concluded, reason = detect_conclusion(messages, round_num, max_rounds)
            if concluded:
                if on_summary:
                    summary = await generate_summary(topic, messages, philosophers[0])
                    await on_summary(summary)
                return messages

    if on_summary:
        summary = await generate_summary(topic, messages, philosophers[0])
        await on_summary(summary)

    return messages
