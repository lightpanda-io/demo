# build and deploy for https://demo.lpd.tch.re
# works only on my machine (pierre)
.PHONY: deploy-preview
deploy-preview:
	@DOCKER_HOST="ssh://uma" docker exec -ti caddy mkdir -p /var/www/demo.lpd.tch.re
	@DOCKER_HOST="ssh://uma" docker exec -ti caddy rm -fr /var/www/demo.lpd.tch.re/public
	@DOCKER_HOST="ssh://uma" docker cp public caddy:/var/www/demo.lpd.tch.re

