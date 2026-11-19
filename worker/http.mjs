export function json(value, status=200) {
  return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
}
export function fail(status,code) {
  throw Object.assign(new Error(code),{status,code});
}
export async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'invalid_body');
  if (Number(request.headers.get('Content-Length'))>256000) fail(413,'invalid_body');
  let value;
  try {
    const reader=request.body?.getReader();
    if (!reader) fail(400,'invalid_body');
    const chunks=[];
    let size=0;
    while (true) {
      const part=await reader.read();
      if (part.done) break;
      size+=part.value.byteLength;
      if (size>256000) {await reader.cancel();fail(413,'invalid_body');}
      chunks.push(part.value);
    }
    value=JSON.parse(await new Blob(chunks).text());
  } catch(error) {
    if (error.status) throw error;
    fail(400,'invalid_body');
  }
  if (!value || typeof value!=='object' || Array.isArray(value)) fail(400,'invalid_body');
  return value;
}
