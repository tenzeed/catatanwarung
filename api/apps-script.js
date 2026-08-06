const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbypIG48h8o5NMLPJmOjcO46FAGx9-J2OdCCMBeFPzgjqL7zfbAwkhysvHDG0Xm1unuj/exec';

module.exports = async (request, response) => {
  try {
    const upstreamUrl = new URL(APPS_SCRIPT_URL);

    for (const [key, value] of Object.entries(request.query || {})) {
      if (typeof value === 'string') upstreamUrl.searchParams.set(key, value);
    }

    const options = { method: request.method, redirect: 'follow' };

    if (!['GET', 'HEAD'].includes(request.method)) {
      const requestBody = Buffer.isBuffer(request.body)
        ? request.body.toString('utf8')
        : typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body || {});

      options.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
      options.body = requestBody;
    }

    const upstreamResponse = await fetch(upstreamUrl, options);
    const responseBody = await upstreamResponse.text();

    response
      .status(upstreamResponse.status)
      .setHeader('Content-Type', upstreamResponse.headers.get('content-type') || 'application/json')
      .send(responseBody);
  } catch (error) {
    response.status(502).json({
      success: false,
      message: 'Tidak dapat menghubungi layanan data.',
    });
  }
};
