import { json } from "../http/json";
import { UserRepository } from "../repositories/user-repository";

export async function handleSessionRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const user = userId ? await new UserRepository(env.DB).findById(userId) : null;

  if (user?.name) {
    return json({
      userId: user.id,
      greeting: `${user.name}你好呀，需要我做什么吗~`,
      shouldCollectProfile: false
    });
  }

  return json({
    userId: user?.id ?? null,
    greeting: "你好，我是 XVC。你可以告诉我你的姓名和邮箱，方便我后续称呼你并保存你的任务；如果暂时不想提供，也可以直接开始使用。",
    shouldCollectProfile: true
  });
}
