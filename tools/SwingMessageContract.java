// Uses the same Client + RawMessage overload as Swing's EditMessageDialog.
// This is an engine-contract comparison, not a desktop UI automation claim.
import com.mirth.connect.client.core.Client;
import com.mirth.connect.donkey.model.message.RawMessage;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Arrays;
import java.util.Map;

class SwingMessageContract {
    public static void main(String[] args) throws Exception {
        try (Client client = new Client(args[0])) {
            if (!"SUCCESS".equals(client.login("admin", "admin").getStatus().name())) {
                throw new IllegalStateException("Owned-engine login failed");
            }
            // Swing collapses all selected destinations to null; a subset is
            // explicit. The web uses the same existing RawMessage endpoint.
            Map<String, Object> sourceMap = new HashMap<>();
            sourceMap.put("releaseOrigin", "paired");
            sourceMap.put("spacing", " value=kept ");
            Long all = client.processMessage(args[1], new RawMessage("ACCEPT", null, sourceMap));
            Long subset = client.processMessage(args[1], new RawMessage("ACCEPT", new HashSet<>(Arrays.asList(2)), sourceMap));
            System.out.println("SWING_MESSAGE_IDS=" + all + "," + subset);
            client.logout();
        }
    }
}
