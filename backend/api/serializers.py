from rest_framework import serializers


class ConvertRequestSerializer(serializers.Serializer):
    file_path = serializers.CharField(required=False, default=None)
    object_name = serializers.CharField(required=False, default=None)
    query = serializers.CharField(required=False, allow_blank=True, default=None)

    def validate(self, data):
        if not data.get("file_path") and not data.get("object_name"):
            raise serializers.ValidationError(
                "Provide either 'file_path' (local path) or 'object_name' (MinIO key)."
            )
        return data


class IngestRequestSerializer(serializers.Serializer):
    minio_key = serializers.CharField()


class QueryRequestSerializer(serializers.Serializer):
    question = serializers.CharField()
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=None)
    model = serializers.CharField(required=False, default=None, allow_null=True)
