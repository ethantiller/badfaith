import time
import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.app.config import get_settings

PROJECT_REF = get_settings().supabase_url
JWKS_URL = f"{PROJECT_REF}/auth/v1/.well-known/jwks.json"
EXPECTED_ISSUER = f"{PROJECT_REF}/auth/v1"

class SupabaseAuth:
    def __init__(self):
        self.client = jwt.PyJWKClient(JWKS_URL)
        self.last_fetched = 0
        self.cache_ttl = 600
        
    def get_verified_payload(self, token: str) -> dict:
        try:
            unverified_header = jwt.get_unverified_header(token)
            token_kid = unverified_header.get("kid")
            
            now = time.time()
            is_expired = (now - self.last_fetched) > self.cache_ttl
            
            if is_expired or token_kid not in [
                k.key_id for k in self.client.get_signing_keys()
            ]:
                self.client.fetch_data()
                self.last_fetched = now
                
            signing_key = self.client.get_signing_key_from_jwt(token)
            
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                issuer=EXPECTED_ISSUER,
                options={"require": ["exp", "iat", "aud", "iss"]}
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired",
            )
        except (jwt.PyJWTError, Exception) as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            ) from e
            
decoder = SupabaseAuth()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(HTTPBearer())
) -> dict:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return decoder.get_verified_payload(credentials.credentials)