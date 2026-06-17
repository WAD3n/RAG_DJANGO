from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler


def no_www_authenticate_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None and isinstance(exc, NotAuthenticated):
        response.status_code = 403
        response["WWW-Authenticate"] = None
    return response
