ARG N8N_VERSION
FROM n8nio/n8n:$N8N_VERSION

RUN npm config set -g production false

RUN mkdir /working-dir
COPY . /working-dir
RUN cd /working-dir && npm install && npm run build && npm pack && \
	cd /usr/local/lib/node_modules/n8n && npm install /working-dir/*.tgz

RUN rm -rf /working-dir

RUN npm config set -g production true
